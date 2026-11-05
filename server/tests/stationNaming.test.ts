import { describe, expect, it } from 'vitest';
import { ensureMountpointNameAvailable } from '../src/lib/stationNaming';
import { ApiError } from '../src/lib/http';

function fakeConn(rows: unknown[]) {
  return {
    query: async () => [rows]
  } as never;
}

describe('ensureMountpointNameAvailable', () => {
  it('trả tên đã trim khi chưa tồn tại', async () => {
    await expect(ensureMountpointNameAvailable(fakeConn([]), ' MP_A ')).resolves.toBe('MP_A');
  });

  it('báo 409 khi tên đã tồn tại', async () => {
    const error = await ensureMountpointNameAvailable(fakeConn([{ id: 1 }]), 'MP_A').catch(
      (item) => item
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
  });

  it('báo 400 khi tên rỗng hoặc quá dài', async () => {
    await expect(ensureMountpointNameAvailable(fakeConn([]), '   ')).rejects.toMatchObject({
      status: 400
    });
    await expect(
      ensureMountpointNameAvailable(fakeConn([]), 'A'.repeat(129))
    ).rejects.toMatchObject({ status: 400 });
  });
});
