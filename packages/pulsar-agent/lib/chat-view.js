'use strict';

const etch = require('etch');
const { CompositeDisposable } = require('event-kit');
const MarkdownIt = require('markdown-it');
const path = require('path');

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

// Mapping of markdown language names to Pulsar scope names
const LANG_SCOPE_MAP = {
  js: 'source.js', javascript: 'source.js', jsx: 'source.js',
  ts: 'source.ts', typescript: 'source.ts', tsx: 'source.ts',
  py: 'source.python', python: 'source.python',
  rb: 'source.ruby', ruby: 'source.ruby',
  java: 'source.java',
  c: 'source.c', cpp: 'source.cpp', 'c++': 'source.cpp',
  cs: 'source.cs', csharp: 'source.cs',
  go: 'source.go', golang: 'source.go',
  rust: 'source.rust', rs: 'source.rust',
  sh: 'source.shell', bash: 'source.shell', zsh: 'source.shell', shell: 'source.shell',
  html: 'text.html.basic', xml: 'text.xml',
  css: 'source.css', less: 'source.css.less', scss: 'source.css.scss', sass: 'source.sass',
  json: 'source.json', yaml: 'source.yaml', yml: 'source.yaml',
  md: 'source.gfm', markdown: 'source.gfm',
  sql: 'source.sql',
  php: 'text.html.php',
  clj: 'source.clojure', clojure: 'source.clojure',
  haskell: 'source.haskell', hs: 'source.haskell',
  elixir: 'source.elixir', ex: 'source.elixir',
  makefile: 'source.makefile', make: 'source.makefile',
  dockerfile: 'source.dockerfile', docker: 'source.dockerfile',
  ini: 'source.ini'
};

function highlightCode(code, lang) {
  const scope = LANG_SCOPE_MAP[lang] || `source.${lang}`;
  const grammar = atom.grammars.grammarForScopeName(scope);
  if (!grammar) return null;

  try {
    const lines = grammar.tokenizeLines(code);
    return lines.map(tokens => {
      return tokens.map(token => {
        const classes = token.scopes.map(s => 'syntax--' + s.replace(/\./g, ' syntax--')).join(' ');
        return `<span class="${classes}">${escapeHtml(token.value)}</span>`;
      }).join('');
    }).join('\n');
  } catch (e) {
    return null;
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Custom renderer for code blocks to add "Apply", "Copy", and "Run" buttons
md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
  const token = tokens[idx];
  const code = token.content.replace(/\n$/, '');
  const lang = (token.info || 'code').trim().toLowerCase();
  
  const isShell = ['bash', 'sh', 'zsh', 'powershell', 'cmd'].includes(lang);
  const highlighted = highlightCode(code, lang);
  
  return `
    <div class="pulsar-agent-code-block" data-lang="${lang}">
      <div class="pulsar-agent-code-header">
        <span class="badged-text">${lang}</span>
        <div class="pulsar-agent-code-actions">
          <button class="btn btn-xs copy-code-btn" title="Copy to clipboard">Copy</button>
          ${isShell ? 
            `<button class="btn btn-xs run-code-btn btn-warning" title="Run in Terminal">Run</button>` : 
            `<button class="btn btn-xs apply-code-btn btn-primary" title="Apply to Editor">Apply</button>`
          }
        </div>
      </div>
      <pre><code class="language-${lang}">${highlighted || escapeHtml(code)}</code></pre>
    </div>
  `;
};

/**
 * The sidebar view for AI Chat.
 */
class ChatView {
  constructor(props) {
    this.props = props;
    this.agentManager = props.agentManager;
    this.messages = this.agentManager.getHistory();
    this.userInput = '';
    this.isProcessing = this.agentManager.isProcessing;
    this.isThinkingCollapsed = false;
    this.pinnedContext = null;
    this.fileContext = this.agentManager.getFileContext();
    
    etch.initialize(this);
    setTimeout(() => this.scrollToBottom(), 100);
    
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(this.agentManager.onDidUpdateHistory((history) => {
      this.messages = history;
      etch.update(this).then(() => this.scrollToBottom());
    }));

    this.subscriptions.add(this.agentManager.onDidUpdateProcessing((processing) => {
      this.isProcessing = processing;
      etch.update(this).then(() => this.scrollToBottom());
    }));

    this.subscriptions.add(this.agentManager.onDidUpdateContext((context) => {
      this.fileContext = context;
      etch.update(this);
    }));

    // Global listener for buttons in markdown
    this.handleGlobalClick = this.handleGlobalClick.bind(this);
    document.addEventListener('click', this.handleGlobalClick);
  }

  handleGlobalClick(e) {
    if (!e.target || !e.target.classList) return;

    if (e.target.classList.contains('apply-code-btn')) {
      const codeBlock = e.target.closest('.pulsar-agent-code-block');
      if (codeBlock) {
        this.applyCodeToEditor(codeBlock.querySelector('code').innerText);
      }
    } else if (e.target.classList.contains('copy-code-btn')) {
      const codeBlock = e.target.closest('.pulsar-agent-code-block');
      if (codeBlock) {
        this.copyToClipboard(codeBlock.querySelector('code').innerText);
        const originalText = e.target.innerText;
        e.target.innerText = 'Copied!';
        setTimeout(() => { e.target.innerText = originalText; }, 2000);
      }
    } else if (e.target.classList.contains('run-code-btn')) {
      const codeBlock = e.target.closest('.pulsar-agent-code-block');
      if (codeBlock) {
        this.runInTerminal(codeBlock.querySelector('code').innerText);
      }
    }
  }

  copyToClipboard(text) {
    atom.clipboard.write(text);
    atom.notifications.addSuccess('Pulsar Agent: Copied to clipboard.');
  }

  runInTerminal(command) {
    const choice = atom.confirm({
      message: 'Run this command in a terminal?',
      detailedMessage: command,
      buttons: ['Run', 'Cancel']
    });

    if (choice === 0) {
      // Try to use a common terminal package command if available
      // or fall back to spawning a process (use with caution)
      const { exec } = require('child_process');
      const projectPath = atom.project.getPaths()[0];
      
      exec(command, { cwd: projectPath || process.cwd() }, (error, stdout, stderr) => {
        if (error) {
          atom.notifications.addError('Pulsar Agent: Command failed.', { detail: error.message });
          return;
        }
        if (stdout) console.log('Ollama Output:', stdout);
        if (stderr) console.error('Ollama Error:', stderr);
        atom.notifications.addSuccess('Pulsar Agent: Command executed successfully.');
      });
    }
  }

  applyCodeToEditor(code) {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      atom.notifications.addWarning('Pulsar Agent: No active editor to apply code.');
      return;
    }

    const selection = editor.getSelectedBufferRange();
    const originalText = editor.getTextInBufferRange(selection);
    
    // Trigger DiffManager
    const DiffManager = require('./diff-manager');
    const diffManager = new DiffManager({ 
      editor, 
      selection, 
      originalText, 
      modifiedText: code 
    });
    diffManager.show();
  }

  /**
   * Required by Pulsar for tab title.
   */
  getTitle() {
    return 'AI Agent';
  }

  /**
   * Required by Pulsar for identification.
   */
  getURI() {
    return 'pulsar://agent-chat';
  }

  /**
   * Specifies where the view should open by default.
   */
  getDefaultLocation() {
    return 'right';
  }

  /**
   * Handles user input submission.
   */
  handleSendMessage(e) {
    e.preventDefault();
    if (!this.userInput.trim()) return;

    this.agentManager.sendMessage(this.userInput);
    this.userInput = '';
    if (this.refs.userInput) {
      this.refs.userInput.value = '';
    }
    etch.update(this).then(() => this.scrollToBottom());
  }

  /**
   * Handles text input changes.
   */
  handleInputChange(e) {
    this.userInput = e.target.value;
  }

  /**
   * Required by Pulsar to focus the view.
   */
  focus() {
    this.updatePinnedContext();
    if (this.refs.userInput) {
      this.refs.userInput.focus();
    }
  }

  updatePinnedContext() {
    const editor = atom.workspace.getActiveTextEditor();
    if (editor) {
      const selection = editor.getSelectedText();
      if (selection) {
        this.pinnedContext = {
          text: selection,
          filePath: path.basename(editor.getPath() || 'unsaved')
        };
      } else {
        this.pinnedContext = null;
      }
      etch.update(this);
    }
  }

  scrollToBottom() {
    if (this.refs.chatHistory) {
      this.refs.chatHistory.scrollTop = this.refs.chatHistory.scrollHeight;
    }
  }

  /**
   * Groups messages by user messages (user messages split the timeline sequences).
   */
  groupMessagesByUser(messages) {
    const groups = [];
    let currentSequence = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (currentSequence.length > 0) {
          groups.push({ type: 'response', items: currentSequence });
          currentSequence = [];
        }
        groups.push({ type: 'user', message: msg });
      } else {
        currentSequence.push(msg);
      }
    }

    if (currentSequence.length > 0) {
      groups.push({ type: 'response', items: currentSequence });
    }

    return groups;
  }

  renderTimelineItem(msg, index, isLastInSequence, isProcessing) {
    const role = msg.role;
    const isThinking = role === 'thinking';
    const isAction = role === 'action';
    const isAssistant = role === 'assistant';

    // Dot class based on role
    let dotClass = 'dot-default';
    if (isThinking) dotClass = 'dot-thinking';
    if (isAction) dotClass = 'dot-action';
    if (isAssistant) dotClass = 'dot-assistant';

    return etch.dom('div', { class: `timeline-item ${isLastInSequence && !isProcessing ? 'timeline-last' : ''}` },
      etch.dom('div', { class: `timeline-dot ${dotClass}` }),
      etch.dom('div', { class: 'timeline-line' }),
      etch.dom('div', { class: 'timeline-content' },
        isThinking || isAction ? 
          etch.dom('div', { class: `pulsar-agent-message tool ${role} ${this.isThinkingCollapsed ? 'collapsed' : ''}` },
            etch.dom('div', { 
              class: 'tool-header',
              on: { click: () => { this.isThinkingCollapsed = !this.isThinkingCollapsed; etch.update(this); } }
            },
              etch.dom('span', { class: `icon ${isThinking ? 'icon-circuit-board' : 'icon-settings'}` }),
              etch.dom('span', { class: 'tool-name' }, isThinking ? 'Thinking' : 'Action'),
              isThinking && isProcessing && isLastInSequence ? 
                etch.dom('div', { class: 'pulsar-agent-thinking-dots' }, 
                  etch.dom('span', { class: 'dot' }), etch.dom('span', { class: 'dot' }), etch.dom('span', { class: 'dot' })
                ) : null
            ),
            !this.isThinkingCollapsed ? 
              etch.dom('div', { class: 'tool-content' }, etch.dom('p', {}, msg.content)) : null
          ) :
          etch.dom('div', { class: `pulsar-agent-message assistant` },
            etch.dom('strong', {}, 'Agent'),
            etch.dom('div', { innerHTML: md.render(msg.content) })
          )
      )
    );
  }

  /**
   * Renders the component.
   */
  render() {
    const groupedMessages = this.groupMessagesByUser(this.messages);

    return etch.dom('div', { class: 'pulsar-agent-chat-container' },
      etch.dom('div', { class: 'pulsar-agent-chat-header' },
        etch.dom('h2', {}, 'AI Agent'),
        etch.dom('button', { 
          class: 'btn btn-xs icon icon-trashcan', 
          title: 'Clear History',
          on: { click: () => this.agentManager.clearChat() }
        })
      ),
      etch.dom('div', { ref: 'chatHistory', class: 'pulsar-agent-chat-history' },
        groupedMessages.map((group, gIndex) => {
          if (group.type === 'user') {
            return etch.dom('div', { class: `pulsar-agent-message user` },
              etch.dom('strong', {}, 'You'),
              etch.dom('div', {}, group.message.content)
            );
          } else {
            const isLastGroup = gIndex === groupedMessages.length - 1;
            return etch.dom('div', { class: 'response-sequence' },
              group.items.map((item, iIndex) => {
                const isLastInSequence = iIndex === group.items.length - 1;
                return this.renderTimelineItem(item, iIndex, isLastInSequence, this.isProcessing && isLastGroup);
              })
            );
          }
        }),
        this.isProcessing && groupedMessages.length > 0 && groupedMessages[groupedMessages.length - 1].type === 'user' ? 
          etch.dom('div', { class: 'response-sequence' },
            this.renderTimelineItem({ role: 'thinking', content: 'Analyzing your request...' }, 0, true, true)
          ) : null
      ),
      etch.dom('div', { class: 'pulsar-agent-chat-footer' },
        etch.dom('div', { class: 'pulsar-agent-context-container' },
          this.pinnedContext ? 
            etch.dom('div', { class: 'pulsar-agent-context-chip' },
              etch.dom('span', { class: 'icon icon-link-external' }),
              etch.dom('span', { class: 'chip-text' }, `Selection: ${this.pinnedContext.filePath}`),
              etch.dom('span', { 
                class: 'icon icon-x close-chip', 
                on: { click: () => { this.pinnedContext = null; etch.update(this); } } 
              })
            ) : null,
          this.fileContext.map(filePath => 
            etch.dom('div', { class: 'pulsar-agent-context-chip attachment' },
              etch.dom('span', { class: 'icon icon-file-code' }),
              etch.dom('span', { class: 'chip-text' }, path.basename(filePath)),
              etch.dom('span', { 
                class: 'icon icon-x close-chip', 
                on: { click: () => this.agentManager.removeFileFromContext(filePath) } 
              })
            )
          )
        ),
        etch.dom('form', { class: 'pulsar-agent-input-form', on: { submit: this.handleSendMessage.bind(this) } },
          etch.dom('input', {
            ref: 'userInput',
            class: 'input-text native-key-bindings',
            type: 'text',
            placeholder: 'Ask the AI...',
            value: this.userInput,
            on: { input: this.handleInputChange.bind(this) }
          }),
          etch.dom('button', { class: 'btn btn-primary' }, 'Send')
        )
      )
    );
  }

  /**
   * Updates the component.
   */
  update(props) {
    return etch.update(this);
  }

  /**
   * Destroys the component.
   */
  async destroy() {
    document.removeEventListener('click', this.handleGlobalClick);
    this.subscriptions.dispose();
    await etch.destroy(this);
  }
}

module.exports = ChatView;
