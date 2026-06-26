import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getChapters, getChapterById, acknowledgeChapter } from '../api/chaptersApi';

export default function ManualPage() {
  const { token } = useAuth();
  const [chapters, setChapters] = useState([]);
  const [selected, setSelected] = useState(null);
  const [chapterBody, setChapterBody] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    (async () => {
      const data = await getChapters(token);
      setChapters(data);
      if (data.length > 0) {
        selectChapter(data[0].id);
      }
    })();
  }, [token]);

  const selectChapter = async (id) => {
    setStatus('');
    const chapter = await getChapterById(id, token);
    setSelected(chapter);
    setChapterBody(chapter.body);
  };

  const onAcknowledge = async () => {
    try {
      await acknowledgeChapter(selected.id, token);
      setStatus('Acknowledged. Thank you.');
    } catch {
      setStatus('Error acknowledging policy.');
    }
  };

  return (
    <div className="manual-page">
      <div className="manual-sidebar">
        <h2>IFCDC Manual</h2>
        <ul>
          {chapters.map(ch => (
            <li key={ch.id}>
              <button
                className={selected?.id === ch.id ? 'active-chapter' : ''}
                onClick={() => selectChapter(ch.id)}
              >
                {ch.number}. {ch.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="manual-content">
        {selected && (
          <>
            <h1>{selected.number}. {selected.title}</h1>
            <p className="chapter-meta">
              Section: {selected.section} • Version: {selected.version}
            </p>
            <div className="chapter-body">
              {chapterBody.split('\n').map((para, idx) => (
                <p key={idx}>{para}</p>
              ))}
            </div>
            <button onClick={onAcknowledge}>
              Mark This Chapter As Read
            </button>
            {status && <div className="ack-status">{status}</div>}
          </>
        )}
      </div>
    </div>
  );
}
