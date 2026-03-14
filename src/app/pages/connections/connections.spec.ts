import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Connections } from './connections';

describe('Friends', () => {
  let component: Connections;
  let fixture: ComponentFixture<Connections>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Connections]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Connections);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
