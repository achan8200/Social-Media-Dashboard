import { Component } from '@angular/core';

@Component({
  selector: 'app-feed',
  standalone: true,
  templateUrl: './feed.html',
  styleUrls: ['./feed.css']
})
export class Feed {
  posts = [
    {
      user: 'User1',
      content: 'This is a sample post in the feed.'
    },
    {
      user: 'User2',
      content: 'Another example post to show the layout.'
    },
    {
      user: 'User3',
      content: 'Loving this social media dashboard project!'
    }
  ];
}