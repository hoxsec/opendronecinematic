import { createRoot } from 'react-dom/client';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles.css';
import { App } from './App';

// No StrictMode: double-mounting would create and destroy two WebGL globes on every load.
createRoot(document.getElementById('root')!).render(<App />);
