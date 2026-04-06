'use strict';

const { Emitter } = require('event-kit');
const fs = require('fs-plus');
const path = require('path');

/**
 * Manages the AI agent state, context collection, and LLM communication.
 */
class AgentManager {
  constructor() {
    this.emitter = new Emitter();
    this.chatHistory = [];
    this.fileContext = []; // Files attached via context menu
    this.isProcessing = false;
    this.currentProject = null;

    // Automatically load history when project changes
    atom.project.onDidChangePaths(() => this.loadProjectHistory());
  }

  /**
   * Registers a listener for history changes.
   */
  onDidUpdateHistory(callback) {
    return this.emitter.on('did-update-history', callback);
  }

  /**
   * Registers a listener for processing state changes.
   */
  onDidUpdateProcessing(callback) {
    return this.emitter.on('did-update-processing', callback);
  }

  /**
   * Registers a listener for file context changes.
   */
  onDidUpdateContext(callback) {
    return this.emitter.on('did-update-context', callback);
  }

  /**
   * Returns the current chat history.
   */
  getHistory() {
    return this.chatHistory;
  }

  /**
   * Returns the current file context.
   */
  getFileContext() {
    return this.fileContext;
  }

  /**
   * Adds a file to the context for the NEXT message.
   */
  addFileToContext(filePath) {
    if (!this.fileContext.includes(filePath)) {
      this.fileContext.push(filePath);
      this.emitter.emit('did-update-context', this.fileContext);
    }
  }

  /**
   * Removes a file from context.
   */
  removeFileFromContext(filePath) {
    this.fileContext = this.fileContext.filter(p => p !== filePath);
    this.emitter.emit('did-update-context', this.fileContext);
  }

  /**
   * Clears history and context.
   */
  clearChat() {
    this.chatHistory = [];
    this.fileContext = [];
    this.emitter.emit('did-update-history', this.chatHistory);
    this.emitter.emit('did-update-context', this.fileContext);
    this.saveHistory();
  }

  /**
   * Adds an activity item (thinking/action) to the current response sequence.
   */
  addActivityItem(type, content) {
    const item = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      role: type, // 'thinking' or 'action'
      content: content
    };
    this.chatHistory.push(item);
    this.emitter.emit('did-update-history', this.chatHistory);
    this.saveHistory();
  }

  /**
   * Collects context from the current editor.
   */
  async collectContext() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) return null;

    const selection = editor.getSelectedText();
    const buffer = editor.getText();
    const filePath = editor.getPath();

    return {
      filePath,
      selection,
      buffer,
      language: editor.getGrammar().name
    };
  }

  /**
   * Sends a message to the AI.
   * @param {string} text - User message text.
   */
  async sendMessage(text) {
    if (text.startsWith('/clear')) {
      this.clearChat();
      return;
    }

    const commandMatch = text.match(/^\/(\w+)\s*(.*)/);
    let systemInstruction = '';
    let userText = text;

    if (commandMatch) {
      const cmd = commandMatch[1];
      const rest = commandMatch[2];
      const commandInfo = this.getSlashCommandInstructions(cmd, rest);
      if (commandInfo) {
        systemInstruction = commandInfo.instruction;
        userText = commandInfo.userText || rest || text;
      }
    }

    const context = await this.collectContext();
    
    // Attach content of all files in fileContext
    const attachments = this.fileContext.map(fp => {
      try {
        return {
          filePath: fp,
          content: fs.readFileSync(fp, 'utf8')
        };
      } catch (e) {
        return { filePath: fp, content: 'Error reading file.' };
      }
    });

    const message = { 
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      role: 'user', 
      content: userText, 
      context,
      attachments,
      systemInstruction // Optional specialized instruction for this turn
    };

    this.chatHistory.push(message);
    this.emitter.emit('did-update-history', this.chatHistory);

    // Call LLM provider
    this.isProcessing = true;
    this.emitter.emit('did-update-processing', true);

    // Add initial "Thinking" action
    this.addActivityItem('thinking', 'Analyzing your request and project context...');
    
    if (commandMatch) {
      this.addActivityItem('action', `Executing slash command: /${commandMatch[1]}`);
    }

    try {
      const response = await this.callLLM(this.chatHistory);
      this.isProcessing = false;
      this.emitter.emit('did-update-processing', false);
      
      this.chatHistory.push({ 
        id: (Date.now() + 1).toString(),
        timestamp: new Date().toISOString(),
        role: 'assistant', 
        content: response 
      });
      this.emitter.emit('did-update-history', this.chatHistory);
      this.saveHistory();
    } catch (error) {
      this.isProcessing = false;
      this.emitter.emit('did-update-processing', false);
      
      atom.notifications.addError('AI Provider Error', {
        detail: error.message,
        dismissable: true
      });
    }
  }

  /**
   * Returns specialized instructions for slash commands.
   */
  getSlashCommandInstructions(cmd, rest) {
    const commands = {
      fix: {
        instruction: 'You are a debugging expert. Analyze the provided context and attachments for bugs, logical errors, or security vulnerabilities and provide specific fixes.',
        userText: rest || 'Please find and fix errors in the provided context.'
      },
      explain: {
        instruction: 'You are a technical educator. Provide a clear, step-by-step explanation of how the provided code works, its purpose, and its architecture.',
        userText: rest || 'Please explain the provided code.'
      },
      test: {
        instruction: 'You are a QA engineer. Generate comprehensive unit tests for the provided code using appropriate frameworks (e.g., Jest, Mocha) and cover edge cases.',
        userText: rest || 'Please generate unit tests for this code.'
      },
      review: {
        instruction: 'You are a senior developer performing a code review. Critically analyze the code for readability, performance, and best practices. Suggest improvements.',
        userText: rest || 'Please perform a code review.'
      }
    };

    return commands[cmd] || null;
  }

  /**
   * Calls the selected LLM provider.
   */
  async callLLM(history) {
    const provider = atom.config.get('pulsar-agent.defaultProvider');
    const apiKey = atom.config.get(`pulsar-agent.${provider}ApiKey`);

    if (!apiKey) {
      throw new Error(`Please set your ${provider.toUpperCase()} API Key in Pulsar Settings.`);
    }

    if (provider === 'openai') {
      return this.callOpenAI(apiKey, history);
    } else if (provider === 'anthropic') {
      return this.callAnthropic(apiKey, history);
    } else if (provider === 'ollama') {
      return this.callOllama(history);
    }
    
    throw new Error(`Unsupported provider: ${provider}`);
  }

  /**
   * Formats chat history into provider-specific messages, injecting context.
   */
  formatMessages(history) {
    return history.map(m => {
      let content = m.content;
      if (m.role === 'user') {
        let contextText = '';
        
        // System Instructions (Slash Commands)
        if (m.systemInstruction) {
          contextText += `[SYSTEM DIRECTIVE]: ${m.systemInstruction}\n`;
        }

        // Active Editor Context
        if (m.context) {
          contextText += `\n[Context: Active Editor]\nFile: ${m.context.filePath || 'unsaved'}\nLanguage: ${m.context.language}\nSelection: ${m.context.selection || 'none'}\nFull Buffer:\n${m.context.buffer}\n`;
        }

        // Attached Files
        if (m.attachments && m.attachments.length > 0) {
          contextText += `\n[Context: Attached Files]\n`;
          m.attachments.forEach(a => {
            contextText += `File: ${a.filePath}\nContent:\n${a.content}\n---\n`;
          });
        }

        if (contextText) {
          content = `COGNITIVE CONTEXT:\n${contextText}\n\nUSER REQUEST: ${m.content}`;
        }
      }
      return { role: m.role, content };
    });
  }

  /**
   * Actual Ollama API call.
   */
  async callOllama(history) {
    const url = atom.config.get('pulsar-agent.ollamaUrl');
    const model = atom.config.get('pulsar-agent.ollamaModel');
    const apiKey = atom.config.get('pulsar-agent.ollamaApiKey');

    const messages = this.formatMessages(history);

    const headers = {
      'Content-Type': 'application/json'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API Error: ${response.statusText} (${response.status})`);
      }

      const data = await response.json();
      return data.message.content;
    } catch (error) {
      console.error('Ollama Fetch Error:', error);
      throw new Error(`Failed to connect to Ollama at ${url}. Ensure Ollama is running.\nDetail: ${error.message}`);
    }
  }

  /**
   * Actual OpenAI API call.
   */
  async callOpenAI(apiKey, history) {
    const messages = this.formatMessages(history);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5.4-nano',
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API Error');
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  /**
   * Actual Anthropic API call.
   */
  async callAnthropic(apiKey, history) {
    const messages = this.formatMessages(history);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Anthropic API Error');
    }

    const data = await response.json();
    return data.content[0].text;
  }

  /**
   * Processes an inline assistance request (Cmd+K).
   */
  async processInlineAssist(editor, instruction) {
    const selection = editor.getSelectedBufferRange();
    const originalText = editor.getTextInBufferRange(selection);

    atom.notifications.addInfo('Pulsar Agent: Processing change...', { detail: instruction });

    try {
      const prompt = `You are a code refactoring assistant. 
                      Original Code:
                      ${originalText}
                      
                      Instruction:
                      ${instruction}
                      
                      Return ONLY the modified code without any explanations or markdown code blocks.`;

      const modifiedText = await this.callLLM([{ role: 'user', content: prompt }]);

      // Initialize DiffManager to handle the preview
      const DiffManager = require('./diff-manager');
      const diffManager = new DiffManager({ editor, selection, originalText, modifiedText });
      diffManager.show();

    } catch (error) {
      atom.notifications.addError('AI Provider Error', {
        detail: error.message,
        dismissable: true
      });
    }
  }

  /**
   * Saves history to the project directory.
   */
  saveHistory() {
    const projectPath = atom.project.getPaths()[0];
    if (!projectPath) return;

    const historyFile = path.join(projectPath, '.pulsar', 'agent-history.json');
    if (!fs.existsSync(path.dirname(historyFile))) {
      fs.makeTreeSync(path.dirname(historyFile));
    }

    fs.writeFileSync(historyFile, JSON.stringify(this.chatHistory, null, 2));
  }

  /**
   * Loads history from the project directory.
   */
  loadProjectHistory() {
    const projectPath = atom.project.getPaths()[0];
    if (!projectPath) {
      this.chatHistory = [];
      return;
    }

    const historyFile = path.join(projectPath, '.pulsar', 'agent-history.json');
    if (fs.existsSync(historyFile)) {
      try {
        this.chatHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      } catch (e) {
        this.chatHistory = [];
      }
    } else {
      this.chatHistory = [];
    }
    this.emitter.emit('did-update-history', this.chatHistory);
  }
}

module.exports = AgentManager;
