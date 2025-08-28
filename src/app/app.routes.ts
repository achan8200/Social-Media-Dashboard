import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { Messages } from './pages/messages/messages';
import { Friends } from './pages/friends/friends';
import { Groups } from './pages/groups/groups';

export const routes: Routes = [
  { path: 'home', component: Home },
  { path: 'messages', component: Messages },
  { path: 'friends', component: Friends },
  { path: 'groups', component: Groups },
  { path: '', redirectTo: '/home', pathMatch: 'full' }, // default
  { path: '**', redirectTo: '/home' } // fallback
];
