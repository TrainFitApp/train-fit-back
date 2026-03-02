class CustomProduct {
  constructor(quantity, order, product, mealId) {
    this.quantity = quantity;
    this.order = order;
    this.product = product;
    this.mealId = mealId || undefined;
  }
}
