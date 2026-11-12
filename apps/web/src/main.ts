import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './styles.css';
import { applyTheme, loadTheme } from './lib/themes';

applyTheme(loadTheme());
createApp(App).use(router).mount('#app');
