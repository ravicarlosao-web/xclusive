import { createRoot } from 'react-dom/client';

import App from './App';
import { instalarSessaoExpirada } from './lib/sessao';

import './index.css';

instalarSessaoExpirada();

createRoot(document.getElementById('root')!).render(<App />);
