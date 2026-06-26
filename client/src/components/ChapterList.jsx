import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getChapters } from '../api/chaptersApi';

export default function ChapterList({ onSelect }) {
  const { token } = useAuth();
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadChapters();
  }, []);

  const loadChapters = async () => {
    try {
      setLoading(true);
      const data = await getChapters(token);
      setChapters(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading chapters...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div data-testid="chapter-list" className="chapter-list">
      {chapters.length === 0 ? (
        <p className="empty-state">No chapters available.</p>
      ) : (
        chapters.map((chapter) => (
          <div
            key={chapter.id}
            data-testid={`chapter-item-${chapter.id}`}
            className="chapter-item"
            onClick={() => onSelect(chapter)}
          >
            <span className="chapter-number">{chapter.number}</span>
            <span className="chapter-title">{chapter.title}</span>
            <span className="chapter-section">{chapter.section}</span>
          </div>
        ))
      )}
    </div>
  );
}
