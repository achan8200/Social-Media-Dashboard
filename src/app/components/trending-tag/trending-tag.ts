import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-trending-tag',
  imports: [],
  templateUrl: './trending-tag.html',
  styleUrl: './trending-tag.css',
})
export class TrendingTag {
  @Input() label!: string;
  @Output() tagClick = new EventEmitter<string>();

  handleClick() {
    this.tagClick.emit(this.label);
  }
}
