const paths = {
  surgery: <><path d="m14 4 6 6-9 9-6-6Z" /><path d="m14 4 2-2 6 6-2 2M5 13l-3 9 9-3M9 9l6 6" /></>,
  imaging: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M12 6v12M8 7c2-1 6-1 8 0M7 10c3-1 7-1 10 0M7 13c3-1 7-1 10 0M8 16c2-1 6-1 8 0" /></>,
  emergency: <><path d="M4 14h4l3-8 3 12 3-6h3" /><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 17v2a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-2" /></>,
  nursery: <><path d="M9 4a3 3 0 0 1 6 0M8 5a8 8 0 1 0 8 0M8 14c2 3 6 3 8 0" /><path d="M8 10h.01M16 10h.01" /></>,
  intensive: <><path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-4 4 1 9 8 15 7-6 12-11 8-15Z" /><path d="M3 12h5l2-4 3 8 2-4h6" /></>,
  consultation: <><path d="M6 3v2M12 3v2M4 4v5a5 5 0 0 0 10 0V4M9 14v2a5 5 0 0 0 10 0v-2" /><circle cx="19" cy="11" r="3" /></>,
  laboratory: <><path d="M9 3h6M10 3v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 15h8" /><path d="M10 18h.01M14 17h.01" /></>,
  hospital: <><path d="M3 4v17M3 17h18v4M7 10h4v7H7ZM11 12h7a3 3 0 0 1 3 3v2M15 3v5M12.5 5.5h5" /></>,
  insurance: <><path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6Z" /><path d="m8 12 3 3 5-6" /></>,
  pharmacy: <><path d="M6 18a5 5 0 0 1 0-7l5-5a5 5 0 0 1 7 7l-5 5a5 5 0 0 1-7 0ZM8 9l7 7" /></>,
  finance: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 9h18M15 14h3M7 14h.01" /></>,
  warehouse: <><path d="m3 7 9-4 9 4v11l-9 4-9-4ZM3 7l9 4 9-4M12 11v11M7.5 5l9 4" /></>,
};

export default function AreaIcon({ name, className }) {
  return <svg className={className} aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    {paths[name] || paths.hospital}
  </svg>;
}
