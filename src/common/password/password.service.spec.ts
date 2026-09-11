import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces a verifiable scrypt hash', async () => {
    const hash = await service.hash('Sunshine123');

    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(service.verify('Sunshine123', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('Sunshine123');

    await expect(service.verify('WrongPassword1', hash)).resolves.toBe(false);
  });

  it('uses a fresh salt so equal passwords hash differently', async () => {
    const [first, second] = await Promise.all([
      service.hash('Sunshine123'),
      service.hash('Sunshine123'),
    ]);

    expect(first).not.toBe(second);
    await expect(service.verify('Sunshine123', first)).resolves.toBe(true);
    await expect(service.verify('Sunshine123', second)).resolves.toBe(true);
  });

  it('returns false for malformed stored hashes', async () => {
    await expect(service.verify('Sunshine123', 'not-a-hash')).resolves.toBe(false);
    await expect(service.verify('Sunshine123', 'scrypt$x$y$z$aa$bb')).resolves.toBe(false);
    await expect(service.verify('Sunshine123', 'bcrypt$16384$8$1$aa$bb')).resolves.toBe(false);
  });
});
