import { LogMailer } from './mailer.js';

describe('LogMailer', () => {
  it('keeps alerts apart from sign-in links', async () => {
    const mailer = new LogMailer();
    await mailer.sendAlert('owner@example.com', 'Budget reached', 'New pages are paused.');
    expect(mailer.alerts).toEqual([{ to: 'owner@example.com', subject: 'Budget reached', text: 'New pages are paused.' }]);
    expect(mailer.sent).toEqual([]);
  });
});
