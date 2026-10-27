export type Money = {
  amount: string;
  currencyCode: string;
};

export function formatMoney(amount: string, currencyCode: string) {
  const value = Number(amount);
  if (!Number.isFinite(value) || !currencyCode) {
    return amount;
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(value);
  } catch {
    return `${amount} ${currencyCode}`;
  }
}

export function formatMoneyValue(money: Money) {
  return formatMoney(money.amount, money.currencyCode);
}
