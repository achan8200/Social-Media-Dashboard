import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Navbar } from './components/navbar/navbar';
import { Sidebar } from './components/sidebar/sidebar';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    Navbar,
    Sidebar,
    CommonModule
],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App {
  constructor(public authService: AuthService) {}
}