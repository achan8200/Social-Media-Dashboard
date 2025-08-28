import { Component } from '@angular/core';
import { Feed } from '../../components/feed/feed';
import { RightSidebar } from '../../components/right-sidebar/right-sidebar';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [Feed, RightSidebar],
  templateUrl: './home.html',
  styleUrls: ['./home.css']
})
export class Home {}