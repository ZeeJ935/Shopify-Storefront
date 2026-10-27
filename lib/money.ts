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
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "code",
    }).format(value);
  } catch {
    return `${currencyCode} ${amount}`;
  }
}

export function formatMoneyValue(money: Money) {
  return formatMoney(money.amount, money.currencyCode);
}
