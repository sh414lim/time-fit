export const formatBusinessNumber = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 10) return value || '-';
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};

export const granterMetric = group => Math.max(Number(group?.inAmount || 0), Number(group?.outAmount || 0));

export function filterGranterRows(rows = [], filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  const normalizedQuery = query.replace(/\D/g, '');
  return rows.filter(row => {
    const haystack = [
      row.content,
      row.description,
      row.category,
      row.asset,
      row.contact,
      row.businessNumber,
      row.ticketTypeLabel,
      ...(row.tags || []).map(tag => tag.name),
    ].join(' ').toLowerCase();
    return (!query || haystack.includes(query) || (normalizedQuery.length >= 3 && String(row.businessNumber || '').replace(/\D/g, '').includes(normalizedQuery)))
      && (!filters.category || row.category === filters.category)
      && (!filters.tag || row.tags?.some(tag => tag.name === filters.tag))
      && (!filters.asset || row.asset === filters.asset)
      && (!filters.contact || row.contact === filters.contact)
      && (!filters.businessNumber || row.businessNumber === filters.businessNumber)
      && (!filters.ticketType || row.ticketType === filters.ticketType)
      && (!filters.direction || row.direction === filters.direction)
      && (!filters.included || (filters.included === 'included' ? row.isIncluded : !row.isIncluded));
  });
}

export function summarizeFilteredGranterRows(rows = []) {
  const included = rows.filter(row => row.isIncluded);
  const inAmount = included.filter(row => row.direction === 'in').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const outAmount = included.filter(row => row.direction === 'out').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return { count: rows.length, includedCount: included.length, inAmount, outAmount, netAmount: inAmount - outAmount };
}
