'use strict';

const etch = require('etch');

/**
 * A floating dialog for inline AI assistance.
 */
class InlineDialog {
  constructor(props) {
    this.props = props;
    this.editor = props.editor;
    this.agentManager = props.agentManager;
    this.userInput = '';
    
    etch.initialize(this);
    
    // Create an overlay decoration at the cursor position
    const cursor = this.editor.getLastCursor();
    this.marker = this.editor.markBufferRange(cursor.getMarker().getBufferRange(), {
      invalidate: 'never'
    });
    
    this.decoration = this.editor.decorateMarker(this.marker, {
      type: 'overlay',
      item: this.element
    });

    // Focus the input
    setTimeout(() => {
      this.element.querySelector('input').focus();
    }, 0);
  }

  /**
   * Handles submission of the inline prompt.
   */
  async handleSubmit(e) {
    e.preventDefault();
    if (!this.userInput.trim()) return;

    const instruction = this.userInput;
    this.destroy(); // Remove dialog while processing
    
    // Trigger the agent manager to process the instruction in-place
    if (this.props.onConfirm) {
      this.props.onConfirm(instruction);
    }
  }

  /**
   * Handles cancellation (Esc key).
   */
  handleCancel() {
    this.destroy();
  }

  /**
   * Updates user input.
   */
  handleInputChange(e) {
    this.userInput = e.target.value;
  }

  /**
   * Renders the floating dialog.
   */
  render() {
    return etch.dom('div', { class: 'pulsar-agent-inline-dialog' },
      etch.dom('form', { on: { submit: this.handleSubmit.bind(this) } },
        etch.dom('input', {
          class: 'input-text native-key-bindings',
          type: 'text',
          placeholder: 'Edit this code...',
          value: this.userInput,
          on: { 
            input: this.handleInputChange.bind(this),
            keydown: (e) => { if (e.key === 'Escape') this.handleCancel(); }
          }
        }),
        etch.dom('div', { class: 'pulsar-agent-inline-help' }, 'Enter to Apply • Esc to Cancel')
      )
    );
  }

  update(props) {
    return etch.update(this);
  }

  /**
   * Destroys the dialog and its markers.
   */
  async destroy() {
    if (this.marker) this.marker.destroy();
    await etch.destroy(this);
  }
}

module.exports = InlineDialog;
