export default function ChapterView({ chapter, onBack }) {
  if (!chapter) return null;

  return (
    <div data-testid="chapter-view" className="chapter-view">
      <button
        data-testid="btn-back"
        onClick={onBack}
        className="btn-back"
      >
        ← Back to List
      </button>
      <div className="chapter-header">
        <h2 data-testid="chapter-title">
          Chapter {chapter.number}: {chapter.title}
        </h2>
        <span className="chapter-meta">
          Section: {chapter.section} | Version: {chapter.version}
        </span>
      </div>
      <div
        data-testid="chapter-body"
        className="chapter-body"
        dangerouslySetInnerHTML={{ __html: chapter.body }}
      />
    </div>
  );
}
