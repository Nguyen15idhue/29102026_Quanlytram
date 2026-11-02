import { useEffect, useState } from 'react';
import { GUIDE_BUILD_HINT, GUIDE_ENTRY, GUIDE_PATH, GUIDE_TITLE } from '../guide';

type GuideStatus = 'checking' | 'ready' | 'missing';

export function Guide() {
  const [status, setStatus] = useState<GuideStatus>('checking');

  useEffect(() => {
    let alive = true;
    fetch(GUIDE_ENTRY, { cache: 'no-store' })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error('http'))))
      .then((html) => {
        if (!alive) return;
        setStatus(html.includes('__docusaurus') ? 'ready' : 'missing');
      })
      .catch(() => {
        if (alive) setStatus('missing');
      });
    return () => {
      alive = false;
    };
  }, []);

  if (status === 'checking') {
    return (
      <div className="guide-frame is-checking" aria-busy="true">
        <div className="page-loading">Đang kiểm tra tài liệu...</div>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="guide-frame is-missing">
        <div className="guide-empty">
          <h2>Tài liệu chưa được build</h2>
          <p>
            Chạy lệnh sau ở thư mục gốc dự án rồi tải lại trang:
            <code>{GUIDE_BUILD_HINT}</code>
          </p>
          <p className="muted">
            Bản triển khai cần build tài liệu trước khi đóng gói frontend.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="guide-frame">
      <div className="guide-frame-bar">
        <span className="muted">Tài liệu hướng dẫn sử dụng</span>
        <a href={GUIDE_PATH} target="_blank" rel="noreferrer">
          Mở toàn màn hình
        </a>
      </div>
      <iframe
        title={GUIDE_TITLE}
        src={GUIDE_PATH}
        referrerPolicy="same-origin"
        className="guide-frame-body"
      />
    </div>
  );
}
