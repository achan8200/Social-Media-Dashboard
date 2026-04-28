import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GroupChatWindow } from './group-chat-window';

describe('GroupChatWindow', () => {
  let component: GroupChatWindow;
  let fixture: ComponentFixture<GroupChatWindow>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupChatWindow]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GroupChatWindow);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
