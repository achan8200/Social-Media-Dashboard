import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsSecurity } from './settings-security';

describe('SettingsSecurity', () => {
  let component: SettingsSecurity;
  let fixture: ComponentFixture<SettingsSecurity>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsSecurity]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingsSecurity);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
