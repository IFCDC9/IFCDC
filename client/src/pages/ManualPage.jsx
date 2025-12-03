import { useState } from 'react';
import Layout from '../components/Layout';
import ChapterList from '../components/ChapterList';
import ChapterView from '../components/ChapterView';

export default function ManualPage() {
  const [selectedChapter, setSelectedChapter] = useState(null);

  return (
    <Layout>
      <div data-testid="manual-page" className="manual-page">
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
    </Layout>
  );
}
