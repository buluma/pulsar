'use strict';

const etch = require('etch');

/**
 * Manages diff visualization and the Accept/Reject workflow.
 */
class DiffManager {
  constructor(props) {
    this.props = props;
    this.editor = props.editor;
    this.selection = props.selection;
    this.originalText = props.originalText;
    this.modifiedText = props.modifiedText;
    
    etch.initialize(this);
  }

  /**
   * Shows the diff by replacing text and adding decorations.
   */
  show() {
    this.editor.transact(() => {
      this.editor.setTextInBufferRange(this.selection, this.modifiedText);
    });

    // Mark the new range
    const newRange = [[this.selection.start.row, 0], [this.selection.start.row + this.modifiedText.split('\n').length - 1, 0]];
    this.marker = this.editor.markBufferRange(newRange, { invalidate: 'never' });
    
    // Highlight the whole block as "added/modified"
    this.editor.decorateMarker(this.marker, {
      type: 'line',
      class: 'pulsar-agent-diff-modified'
    });

    // Add Accept/Reject overlay at the end of the block
    this.overlayMarker = this.editor.markBufferRange([[newRange[1][0], 0], [newRange[1][0], 0]]);
    this.overlayDecoration = this.editor.decorateMarker(this.overlayMarker, {
      type: 'overlay',
      item: this.element,
      position: 'after'
    });
  }

  /**
   * Accepts the changes and cleans up.
   */
  handleAccept() {
    this.destroy();
    atom.notifications.addSuccess('Pulsar Agent: Change accepted.');
  }

  /**
   * Rejects the changes and restores the original code.
   */
  handleReject() {
    this.editor.transact(() => {
      this.editor.setTextInBufferRange(this.marker.getBufferRange(), this.originalText);
    });
    this.destroy();
    atom.notifications.addInfo('Pulsar Agent: Change rejected.');
  }

  /**
   * Renders the Accept/Reject controls.
   */
  render() {
    return etch.dom('div', { class: 'pulsar-agent-diff-controls' },
      etch.dom('button', { class: 'btn btn-success icon icon-check', on: { click: this.handleAccept.bind(this) } }, 'Accept'),
      etch.dom('button', { class: 'btn btn-error icon icon-x', on: { click: this.handleReject.bind(this) } }, 'Reject')
    );
  }

  update(props) {
    return etch.update(this);
  }

  /**
   * Destroys markers and overlay.
   */
  async destroy() {
    if (this.marker) this.marker.destroy();
    if (this.overlayMarker) this.overlayMarker.destroy();
    await etch.destroy(this);
  }
}

module.exports = DiffManager;
