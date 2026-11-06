export const TimeUnit = Object.freeze({
  DAY: 'day',
  WEEK: 'week',
});

export class GameTimeManager {
  constructor({ onDayElapsed, startYear = 1, startMonth = 1, startDay = 1 } = {}) {
    if (typeof onDayElapsed !== 'function') {
      throw new TypeError('onDayElapsed must be a function.');
    }
    this.year = startYear;
    this.month = startMonth;
    this.day = startDay;
    this.daysInMonth = 30;
    this.monthsInYear = 12;
    this.onDayElapsed = onDayElapsed;
  }

  advanceDay() {
    const shouldContinue = this.onDayElapsed(this.getDateState());
    if (shouldContinue === false) return false;

    this.day += 1;

    if (this.day > this.daysInMonth) {
      this.day = 1;
      this.month += 1;
      if (this.month > this.monthsInYear) {
        this.month = 1;
        this.year += 1;
      }
    }
    return true;
  }

  elapseTurn(unit, amount = 1) {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new RangeError('Time amount must be a positive integer.');
    }

    let daysToElapse;
    if (unit === TimeUnit.DAY) {
      daysToElapse = amount;
    } else if (unit === TimeUnit.WEEK) {
      daysToElapse = 7 * amount;
    } else {
      throw new Error(`Invalid TimeUnit: ${unit}.`);
    }

    let elapsed = 0;
    while (elapsed < daysToElapse) {
      elapsed += 1;
      if (!this.advanceDay()) break;
    }
    return elapsed;
  }

  getDateState() {
    return {
      year: this.year,
      month: this.month,
      day: this.day,
      formatted: `Year ${this.year}, Month ${this.month}, Day ${this.day}`,
    };
  }
}
