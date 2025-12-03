import { useState } from 'react';
import ChapterList from '../components/ChapterList';
import ChapterView from '../components/ChapterView';

export default function ManualPage() {
  const [selectedChapter, setSelectedChapter] = useState(null);

  return (
    <div data-testid="manual-page" className="page">
      <h2>Policy Manual</h2>
      
      {selectedChapter ? (
        <ChapterView
          chapter={selectedChapter}
          onBack={() => setSelectedChapter(null)}
        />
      ) : (
        <ChapterList onSelect={setSelectedChapter} />
      )}
    </div>
  );
}
