import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { Messages } from './pages/messages/messages';
import { Notifications } from './pages/notifications/notifications';
import { Connections } from './pages/connections/connections';
import { Groups } from './pages/groups/groups';
import { GroupPage } from './pages/group-page/group-page';
import { Login } from './components/login/login';
import { Signup } from './components/signup/signup';
import { Profile } from './pages/profile/profile';
import { PostView } from './pages/post-view/post-view';
import { Settings } from './pages/settings/settings';
import { SettingsProfile } from './pages/settings/settings-profile/settings-profile';
import { SettingsAppearance } from './pages/settings/settings-appearance/settings-appearance';
import { SettingsSecurity } from './pages/settings/settings-security/settings-security';
import { SettingsAccount } from './pages/settings/settings-account/settings-account';
import { AuthGuard } from './guards/auth-guard';
import { GuestGuard } from './guards/guest-guard';

export const routes: Routes = [
  { path: 'home', component: Home },
  { path: 'messages', component: Messages, canActivate: [AuthGuard] },
  { path: 'notifications', component: Notifications, canActivate: [AuthGuard] },
  { path: 'connections/:username', component: Connections }, // public view
  { path: 'connections', component: Connections, canActivate: [AuthGuard] }, // your own
  { path: 'groups/:username', component: Groups}, // public view
  { path: 'groups', component: Groups, canActivate: [AuthGuard] }, // your own
  { path: 'group/:groupId', component: GroupPage},
  { path: 'login', component: Login, canActivate: [GuestGuard] },
  { path: 'signup', component: Signup, canActivate: [GuestGuard] },
  { path: 'profile/:userId', component: Profile },
  { path: 'u/:username', component: Profile },
  { path: 'post/:postId', component: PostView },
  {
    path: 'settings',
    component: Settings,
    canActivate: [AuthGuard],
    children: [
      { path: '', redirectTo: 'profile', pathMatch: 'full' },
      { path: 'profile', component: SettingsProfile },
      { path: 'appearance', component: SettingsAppearance },
      { path: 'security', component: SettingsSecurity },
      { path: 'account', component: SettingsAccount }
    ]
  },
  { path: '', redirectTo: 'login', pathMatch: 'full' }, // default
  { path: '**', redirectTo: 'login' }, // fallback
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
