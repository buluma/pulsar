'use strict';

const { CompositeDisposable } = require('event-kit');
const AgentManager = require('./agent-manager');
const ChatView = require('./chat-view');
const InlineDialog = require('./inline-dialog');

module.exports = {
  subscriptions: null,
  agentManager: null,
  chatView: null,

  /**
   * Activates the package.
   * @param {object} state - Serialized state from previous session.
   */
  activate(state) {
    this.subscriptions = new CompositeDisposable();
    this.agentManager = new AgentManager();
    
    // Register commands
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'pulsar-agent:toggle-chat': () => this.toggleChat(),
      'pulsar-agent:inline-assist': () => this.inlineAssist(),
      'pulsar-agent:add-file-to-chat': (e) => this.addFileToChat(e)
    }));
  },

  /**
   * Deactivates the package.
   */
  deactivate() {
    if (this.subscriptions) {
      this.subscriptions.dispose();
      this.subscriptions = null;
    }
    if (this.chatView) {
      this.chatView.destroy();
      this.chatView = null;
    }
  },

  /**
   * Toggles the AI Chat sidebar.
   */
  toggleChat() {
    if (!this.chatView) {
      this.chatView = new ChatView({ agentManager: this.agentManager });
    }
    
    atom.workspace.toggle(this.chatView).then(isOpened => {
      if (isOpened && this.chatView) {
        this.chatView.focus();
      }
    });
  },

  /**
   * Triggers the inline AI assistant.
   */
  inlineAssist() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) return;

    new InlineDialog({
      editor,
      agentManager: this.agentManager,
      onConfirm: (instruction) => {
        this.agentManager.processInlineAssist(editor, instruction);
      }
    });
  },

  /**
   * Adds the currently selected file (from tree view or editor) to the chat context.
   */
  addFileToChat(event) {
    let filePath;

    // From Tree View
    if (event && event.target && event.target.closest('.file')) {
      const selected = event.target.closest('.file').querySelector('.name');
      if (selected && selected.dataset.path) {
        filePath = selected.dataset.path;
      }
    }

    // From Editor
    if (!filePath) {
      const editor = atom.workspace.getActiveTextEditor();
      if (editor) filePath = editor.getPath();
    }

    if (filePath) {
      this.agentManager.addFileToContext(filePath);
      // Ensure chat is open
      this.toggleChat();
      if (this.chatView) {
        setTimeout(() => this.chatView.focus(), 100);
      }
    } else {
      atom.notifications.addWarning('Pulsar Agent: No file path found to add to chat.');
    }
  },

  /**
   * Serializes the package state.
   */
  serialize() {
    return {};
  }
};
