const {
  filterVisiblePatientNotifications,
  markNotificationDismissed
} = require('../apps/backend/services/patient-notifications.service');

describe('patient notification helpers', () => {
  it('shows queued outbound messages that the patient has not dismissed', () => {
    const messages = filterVisiblePatientNotifications([
      {
        id: 'message-1',
        direction: 'outbound',
        deliveryStatus: 'queued',
        body: 'Please rebook your missed appointment.',
        metadata: {}
      },
      {
        id: 'message-2',
        direction: 'outbound',
        deliveryStatus: 'queued',
        body: 'Already dismissed.',
        metadata: { patientDismissedAt: '2026-07-29T10:00:00.000Z' }
      },
      {
        id: 'message-3',
        direction: 'inbound',
        deliveryStatus: 'queued',
        body: 'Inbound patient text.',
        metadata: {}
      }
    ]);

    expect(visibleMessageBodies(messages)).toEqual(['Please rebook your missed appointment.']);
  });

  it('preserves existing metadata when marking a notification dismissed', () => {
    const dismissed = markNotificationDismissed({
      type: 'no_show_follow_up',
      quickRebookPath: '/book?doctorId=doc-1'
    });

    expect(dismissed).toMatchObject({
      type: 'no_show_follow_up',
      quickRebookPath: '/book?doctorId=doc-1'
    });
    expect(new Date(dismissed.patientDismissedAt).toString()).not.toBe('Invalid Date');
  });
});

function visibleMessageBodies(messages) {
  return messages.map((message) => message.body);
}
