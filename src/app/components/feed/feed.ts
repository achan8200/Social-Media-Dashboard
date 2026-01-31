import { Component, OnInit, AfterViewInit, ElementRef, QueryList, ViewChildren, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { AsyncPipe, CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { PostCard } from '../post-card/post-card';
import { Post } from '../../models/post.model';
import { PostsService } from '../../services/posts.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [AsyncPipe, CommonModule, FormsModule, PostCard],
  templateUrl: './feed.html',
  styleUrls: ['./feed.css']
})
export class Feed implements OnInit, AfterViewInit {
  posts$: Observable<Post[]>;
  dashboardState$: Observable<{ count: number; fading: boolean }>;

  newPostText: string = '';

  @ViewChildren('postRef') postElements!: QueryList<ElementRef>;
  private observer!: IntersectionObserver;
  private isBrowser: boolean;

  constructor(
    private postsService: PostsService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.posts$ = this.postsService.posts$;
    this.dashboardState$ = this.postsService.dashboardState$;
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit() {}

  ngAfterViewInit() {
    if (!this.isBrowser) return;

    this.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const postEl = entry.target as HTMLElement;
          const postId = Number(postEl.dataset['id']);

          // Delay 2s before marking post as seen
          setTimeout(() => {
            this.postsService.markPostAsSeen(postId);
            this.cdr.markForCheck();
            this.observer.unobserve(postEl);
          }, 2000);
        }
      });
    }, { threshold: 0.5 });

    // Observe initial posts
    this.postElements.forEach(postEl => this.observer.observe(postEl.nativeElement));

    // Observe future posts
    this.postElements.changes.subscribe(posts => {
      posts.forEach((postEl: { nativeElement: Element; }) => this.observer.observe(postEl.nativeElement));
    });
  }

  addPost() {
    if (this.newPostText.trim()) {
      this.postsService.addPost('You', this.newPostText);
      this.newPostText = '';
    }
  }

  likePost(id: number) { 
    this.postsService.likePost(id); 
  }

  commentPost(id: number) { 
    this.postsService.commentPost(id); 
  
  }
  sharePost(id: number) { 
    this.postsService.sharePost(id); 
  }
}
