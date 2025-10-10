import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TrendingTag } from './trending-tag';

describe('TrendingTag', () => {
  let component: TrendingTag;
  let fixture: ComponentFixture<TrendingTag>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrendingTag]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TrendingTag);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
