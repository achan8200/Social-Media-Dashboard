import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FeedStateService {

  // Selected hashtag filter
  private selectedTagSubject =
    new BehaviorSubject<string | null>(null);

  selectedTag$ =
    this.selectedTagSubject.asObservable();

  // Feed filter
  private feedFilterSubject =
    new BehaviorSubject<'forYou' | 'latest' | 'following'>('forYou');

  feedFilter$ =
    this.feedFilterSubject.asObservable();

  setTag(tag: string | null) {
    this.selectedTagSubject.next(tag);
  }

  setFeedFilter(
    filter: 'forYou' | 'latest' | 'following'
  ) {
    this.feedFilterSubject.next(filter);
  }

  getSelectedTagValue(): string | null {
    return this.selectedTagSubject.value;
  }
}