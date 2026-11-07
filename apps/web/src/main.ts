import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import './styles.css';

createApp(App).use(router).mount('#app');
