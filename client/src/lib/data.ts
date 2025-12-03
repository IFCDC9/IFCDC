export interface Chapter {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  updatedAt: string;
  formCount: number;
}

export interface Form {
  id: string;
  title: string;
  chapterId: string;
  submissions: number;
  status: 'active' | 'closed';
}

export const MOCK_CHAPTERS: Chapter[] = [
  {
    id: '1',
    title: 'Introduction to Chemistry',
    description: 'Basic concepts of atoms, molecules, and chemical bonds.',
    status: 'published',
    updatedAt: '2023-10-15',
    formCount: 3,
  },
  {
    id: '2',
    title: 'Advanced Organic Synthesis',
    description: 'Deep dive into carbon structures and reaction mechanisms.',
    status: 'draft',
    updatedAt: '2023-11-02',
    formCount: 1,
  },
  {
    id: '3',
    title: 'Lab Safety Procedures',
    description: 'Mandatory safety protocols for all laboratory personnel.',
    status: 'published',
    updatedAt: '2023-09-20',
    formCount: 5,
  },
  {
    id: '4',
    title: 'Research Methodology',
    description: 'How to conduct proper scientific research and documentation.',
    status: 'archived',
    updatedAt: '2023-08-10',
    formCount: 0,
  },
];

export const MOCK_FORMS: Form[] = [
  { id: 'f1', title: 'Pre-lab Assessment', chapterId: '1', submissions: 45, status: 'active' },
  { id: 'f2', title: 'Safety Quiz', chapterId: '3', submissions: 120, status: 'active' },
  { id: 'f3', title: 'Experiment 1 Feedback', chapterId: '1', submissions: 32, status: 'closed' },
  { id: 'f4', title: 'Synthesis Report Upload', chapterId: '2', submissions: 0, status: 'active' },
];
