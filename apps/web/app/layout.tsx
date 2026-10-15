import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ContextLab — LLM QA Workbench',
  description: 'Local authenticated chat and context-budget testbed for Ollama.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
