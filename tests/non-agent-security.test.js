const { requireAdminInvite, safeEqual } = require('../apps/backend/middleware/registration-security');
const { detectDocumentMime } = require('../apps/backend/middleware/document-upload');
const {
  PHARMACY_TRANSITIONS,
  LAB_TRANSITIONS,
  canTransition
} = require('../apps/backend/middleware/order-transitions');

function mockResponse() {
  return {
    statusCode: 200,
    view: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, payload) {
      this.view = view;
      this.payload = payload;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

describe('non-agent security hardening', () => {
  const originalInvite = process.env.ADMIN_INVITE_CODE;

  afterEach(() => {
    if (originalInvite === undefined) delete process.env.ADMIN_INVITE_CODE;
    else process.env.ADMIN_INVITE_CODE = originalInvite;
  });

  test('timing-safe invite comparison rejects empty and mismatched values', () => {
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual('secret-123', 'secret-123')).toBe(true);
    expect(safeEqual('secret-123', 'wrong')).toBe(false);
  });

  test('admin registration fails closed when invite is not configured', () => {
    delete process.env.ADMIN_INVITE_CODE;
    const req = { body: { role: 'admin', adminInviteCode: '' } };
    const res = mockResponse();
    const next = jest.fn();

    requireAdminInvite(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.payload.error).toMatch(/disabled/i);
  });

  test('admin registration requires exact configured invite', () => {
    process.env.ADMIN_INVITE_CODE = 'configured-secret';
    const denied = mockResponse();
    requireAdminInvite({ body: { role: 'admin', adminInviteCode: 'wrong' } }, denied, jest.fn());
    expect(denied.statusCode).toBe(403);

    const allowed = mockResponse();
    const next = jest.fn();
    requireAdminInvite({ body: { role: 'admin', adminInviteCode: 'configured-secret' } }, allowed, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('non-admin registration is unaffected by admin invite configuration', () => {
    delete process.env.ADMIN_INVITE_CODE;
    const next = jest.fn();
    requireAdminInvite({ body: { role: 'patient' } }, mockResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('medical upload signatures accept PDF PNG and JPEG only', () => {
    expect(detectDocumentMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(detectDocumentMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectDocumentMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectDocumentMime(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectDocumentMime(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeNull();
  });

  test('pharmacy lifecycle cannot skip or reopen terminal states', () => {
    expect(canTransition(PHARMACY_TRANSITIONS, 'placed', 'processing')).toBe(true);
    expect(canTransition(PHARMACY_TRANSITIONS, 'placed', 'delivered')).toBe(false);
    expect(canTransition(PHARMACY_TRANSITIONS, 'ready', 'delivered')).toBe(true);
    expect(canTransition(PHARMACY_TRANSITIONS, 'delivered', 'processing')).toBe(false);
    expect(canTransition(PHARMACY_TRANSITIONS, 'cancelled', 'placed')).toBe(false);
  });

  test('lab lifecycle cannot skip processing or reopen terminal states', () => {
    expect(canTransition(LAB_TRANSITIONS, 'requested', 'sample_collected')).toBe(true);
    expect(canTransition(LAB_TRANSITIONS, 'requested', 'completed')).toBe(false);
    expect(canTransition(LAB_TRANSITIONS, 'processing', 'report_ready')).toBe(true);
    expect(canTransition(LAB_TRANSITIONS, 'completed', 'processing')).toBe(false);
    expect(canTransition(LAB_TRANSITIONS, 'cancelled', 'requested')).toBe(false);
  });
});
