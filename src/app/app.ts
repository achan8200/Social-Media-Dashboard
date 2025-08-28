import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Navbar } from './components/navbar/navbar';
import { Sidebar } from './components/sidebar/sidebar';
import { Feed } from './components/feed/feed';
import { RightSidebar } from './components/right-sidebar/right-sidebar';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    Navbar,
    Sidebar,
    Feed,
    RightSidebar
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App {}