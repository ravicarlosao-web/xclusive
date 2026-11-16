import { createRoot } from 'react-dom/client';

import App from './App';
import { iniciarPwa } from './lib/pwa';

import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// App instalável: regista o service worker só em produção (ver lib/pwa.ts); falhas são silenciosas.
iniciarPwa();
