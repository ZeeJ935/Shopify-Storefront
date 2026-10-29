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

// Integer math in thousandths covers 0-, 2- and 3-decimal currencies without float drift.
const MONEY_SCALE = 1000;

function toScaled(amount: string) {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * MONEY_SCALE) : 0;
}

function fromScaled(scaled: number) {
  return (scaled / MONEY_SCALE).toString();
}

export function multiplyMoney(money: Money, quantity: number): Money {
  return {
    amount: fromScaled(toScaled(money.amount) * quantity),
    currencyCode: money.currencyCode,
  };
}

export function sumMoney(values: Money[], currencyCode: string): Money {
  const total = values.reduce((sum, value) => sum + toScaled(value.amount), 0);
  return { amount: fromScaled(total), currencyCode };
}
