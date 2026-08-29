"use client";

export function QuestionDeleteDialog({ deleting, error, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="delete-question-description"
        aria-labelledby="delete-question-title"
        aria-modal="true"
        className="communication-modal confirmation-modal"
        role="dialog"
      >
        <header className="communication-modal-header">
          <h2 id="delete-question-title">Delete this question?</h2>
        </header>
        <div className="confirmation-modal-body">
          <p id="delete-question-description">This action cannot be undone.</p>
          {error ? <p className="inline-alert">{error}</p> : null}
        </div>
        <div className="form-actions confirmation-modal-actions">
          <button className="secondary-button" disabled={deleting} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="danger-button" disabled={deleting} onClick={onConfirm} type="button">
            {deleting ? "Deleting..." : "Delete question"}
          </button>
        </div>
      </section>
    </div>
  );
}
