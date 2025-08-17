import { Component } from '@angular/core';
import { Navbar } from './components/navbar/navbar';
import { Sidebar } from './components/sidebar/sidebar';
import { Feed } from './components/feed/feed';
import { RightSidebar } from './components/right-sidebar/right-sidebar';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    Navbar,
    Sidebar,
    Feed,
    RightSidebar
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App {}