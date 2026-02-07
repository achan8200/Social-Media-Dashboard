import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { Messages } from './pages/messages/messages';
import { Friends } from './pages/friends/friends';
import { Groups } from './pages/groups/groups';
import { Login } from './components/login/login';
import { Signup } from './components/signup/signup';
import { AuthGuard } from './guards/auth-guard';
import { GuestGuard } from './guards/guest-guard';
import { Profile } from './pages/profile/profile';

export const routes: Routes = [
  { path: 'home', component: Home, canActivate: [AuthGuard] },
  { path: 'messages', component: Messages, canActivate: [AuthGuard] },
  { path: 'friends', component: Friends, canActivate: [AuthGuard] },
  { path: 'groups', component: Groups, canActivate: [AuthGuard] },
  { path: 'login', component: Login, canActivate: [GuestGuard] },
  { path: 'signup', component: Signup, canActivate: [GuestGuard] },
  { path: 'profile/:userId', component: Profile, canActivate: [AuthGuard] },
  { path: 'u/:username', component: Profile, canActivate: [AuthGuard] },
  { path: '', redirectTo: 'login', pathMatch: 'full' }, // default
  { path: '**', redirectTo: 'login' }, // fallback
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
