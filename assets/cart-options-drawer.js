import { DialogComponent } from '@theme/dialog';
import { fetchConfig } from '@theme/utilities';
import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

const CONTENT_SECTION_ID = 'cart-options-drawer-content';
const CART_SECTION_ID = 'cart-drawer-section';

/**
 * @typedef {object} VariantOption
 * @property {number} id
 * @property {string} title
 * @property {boolean} available
 * @property {number} price
 * @property {number | null} compare_at_price
 * @property {string[]} options
 */

/**
 * A nested bottom-sheet dialog that lists a product's option values and selling plans
 * so a shopper can add (or add another of) a product without leaving the cart drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 * @property {HTMLElement} content - The container the fetched product options are injected into.
 * @property {HTMLElement} title - The dialog heading.
 * @property {HTMLFormElement} [form] - The injected options form.
 * @property {HTMLElement} [price] - The injected price element.
 * @property {HTMLElement} [comparePrice] - The injected compare-at price element.
 * @property {HTMLInputElement} [variantId] - The hidden variant id input.
 * @property {HTMLScriptElement} [variantData] - JSON script holding `product.variants`.
 * @property {HTMLInputElement} [quantity] - The quantity input.
 * @property {HTMLSelectElement} [planSelect] - The selling plan select.
 * @property {HTMLButtonElement} [submit] - The submit button.
 * @property {HTMLElement} [submitLabel] - The submit button label.
 * @property {HTMLElement} [error] - The error message element.
 *
 * @extends {DialogComponent}
 */
class CartOptionsDrawer extends DialogComponent {
  /** @type {AbortController | null} */
  #fetchAbortController = null;

  /** @type {'add' | 'line'} */
  #mode = 'add';

  /** @type {string} */
  #lineKey = '';

  /** @type {string} */
  #originalVariantId = '';

  /** @type {string} */
  #originalSellingPlan = '';

  /** @type {number} */
  #currentQuantity = 1;

  /** @type {string} */
  #moneyFormat = '';

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#fetchAbortController?.abort();
  }

  /**
   * Opens the sheet in "add" mode for an upsell product.
   * @param {Event} event - The click event.
   */
  openForProduct(event) {
    event.preventDefault();
    // Events are delegated from `document` (component.js), so `currentTarget` is the document.
    // The proxied `event.target` is the element carrying the `on:click` attribute.
    const trigger = /** @type {HTMLElement | null} */ (
      event.target instanceof HTMLElement ? event.target.closest('[data-product-url]') : null
    );
    if (!trigger) return;

    this.#mode = 'add';
    this.#lineKey = '';
    this.#originalVariantId = trigger.dataset.variantId || '';
    this.#originalSellingPlan = trigger.dataset.sellingPlan || '';
    this.#currentQuantity = Number(trigger.dataset.quantity) || 1;

    this.#open(trigger.dataset.productUrl || '', 'Choose options');
  }

  /**
   * Opens the sheet in "line" mode from a cart line's plus button.
   * @param {Event} event - The click event.
   */
  openForLine(event) {
    event.preventDefault();
    // Events are delegated from `document` (component.js), so `currentTarget` is the document.
    // The proxied `event.target` is the element carrying the `on:click` attribute.
    const trigger = /** @type {HTMLElement | null} */ (
      event.target instanceof HTMLElement ? event.target.closest('[data-product-url]') : null
    );
    if (!trigger) return;

    this.#mode = 'line';
    this.#lineKey = trigger.dataset.lineKey || '';
    this.#originalVariantId = trigger.dataset.variantId || '';
    this.#originalSellingPlan = trigger.dataset.sellingPlan || '';
    this.#currentQuantity = Number(trigger.dataset.quantity) || 1;

    this.#open(trigger.dataset.productUrl || '', 'Add another');
  }

  /**
   * Fetches the options markup and shows the dialog.
   * @param {string} productUrl
   * @param {string} title
   */
  async #open(productUrl, title) {
    if (!productUrl) return;

    const { content, title: titleRef } = this.refs;
    if (titleRef) titleRef.textContent = title;
    content.innerHTML = '<p class="cart-options-drawer__loading">Loading…</p>';
    this.showDialog();

    const body = await this.#fetchOptions(productUrl);
    if (!body) {
      content.innerHTML = '<p class="cart-options-drawer__loading">Unable to load product options.</p>';
      return;
    }

    content.innerHTML = body.innerHTML;
    // Refs are normally refreshed by the MutationObserver (async); force a sync refresh so the
    // injected form/variant data is addressable immediately.
    this.updatedCallback();
    this.#moneyFormat = content.querySelector('[data-money-format]')?.getAttribute('data-money-format') || '';

    this.#preselect();
    this.#syncSelectedVariant();
  }

  /**
   * Fetches the product page section that renders the options form.
   * @param {string} productUrl
   * @returns {Promise<Element | null>}
   */
  async #fetchOptions(productUrl) {
    this.#fetchAbortController?.abort();
    this.#fetchAbortController = new AbortController();

    try {
      const url = new URL(productUrl, window.location.origin);
      url.searchParams.set('section_id', CONTENT_SECTION_ID);

      const response = await fetch(url.toString(), { signal: this.#fetchAbortController.signal });
      if (!response.ok) throw new Error(`Failed to fetch product options: HTTP ${response.status}`);

      const html = new DOMParser().parseFromString(await response.text(), 'text/html');
      return html.querySelector('.cart-options-drawer__body');
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      console.warn('[cart-options-drawer] Failed to load options:', error);
      return null;
    } finally {
      this.#fetchAbortController = null;
    }
  }

  /**
   * Preselects option radios and purchase type to match the originating variant / plan.
   */
  #preselect() {
    const { content, quantity, planSelect } = this.refs;
    const variant = this.#findVariantById(this.#originalVariantId);

    if (variant) {
      variant.options.forEach((value, index) => {
        const radios = content.querySelectorAll(`input[type="radio"][name="option-${index + 1}"]`);
        for (const radio of radios) {
          if (radio instanceof HTMLInputElement && radio.value === value) {
            radio.checked = true;
            break;
          }
        }
      });
    }

    const purchaseRadios = content.querySelectorAll('input[type="radio"][name="purchase_type"]');
    for (const radio of purchaseRadios) {
      if (!(radio instanceof HTMLInputElement)) continue;
      radio.checked = this.#originalSellingPlan ? radio.value === 'subscribe' : radio.value === 'one-time';
    }

    if (planSelect) {
      if (this.#originalSellingPlan) planSelect.value = this.#originalSellingPlan;
      planSelect.disabled = !this.#isSubscribeSelected();
    }

    if (quantity) quantity.value = '1';
  }

  /**
   * Handles a change on any option / purchase-type input.
   * @param {Event} event
   */
  handleOptionChange(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === 'purchase_type' && this.refs.planSelect) {
      this.refs.planSelect.disabled = !this.#isSubscribeSelected();
    }
    this.#syncSelectedVariant();
  }

  /**
   * Returns the parsed variants embedded in the injected markup.
   * @returns {VariantOption[]}
   */
  #getVariants() {
    const { variantData } = this.refs;
    if (!variantData) return [];
    try {
      const parsed = JSON.parse(variantData.textContent || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * @param {string} id
   * @returns {VariantOption | undefined}
   */
  #findVariantById(id) {
    if (!id) return undefined;
    return this.#getVariants().find((variant) => String(variant.id) === String(id));
  }

  /**
   * Reads the checked radio value for each option position.
   * @returns {string[]}
   */
  #getSelectedOptionValues() {
    const { content } = this.refs;
    const values = [];
    let index = 1;
    while (true) {
      const checked = content.querySelector(`input[type="radio"][name="option-${index}"]:checked`);
      const anyRadio = content.querySelector(`input[type="radio"][name="option-${index}"]`);
      if (!anyRadio) break;
      values.push(checked instanceof HTMLInputElement ? checked.value : '');
      index += 1;
    }
    return values;
  }

  /**
   * @returns {VariantOption | undefined}
   */
  #resolveSelectedVariant() {
    const variants = this.#getVariants();
    if (variants.length === 0) return undefined;
    if (variants.length === 1) return variants[0];

    const selected = this.#getSelectedOptionValues();
    if (selected.length === 0) return variants[0];

    return variants.find((variant) => variant.options.every((value, index) => value === selected[index]));
  }

  #isSubscribeSelected() {
    const radio = this.refs.content.querySelector('input[type="radio"][name="purchase_type"]:checked');
    return radio instanceof HTMLInputElement && radio.value === 'subscribe';
  }

  /**
   * @returns {string}
   */
  #getSelectedSellingPlan() {
    const { planSelect } = this.refs;
    if (!planSelect || !this.#isSubscribeSelected()) return '';
    return planSelect.value || '';
  }

  /**
   * Formats a price in cents using the shop money format captured from Liquid.
   * @param {number} cents
   * @returns {string}
   */
  #formatMoney(cents) {
    const amount = (cents / 100).toFixed(2);
    const [whole, fraction] = amount.split('.');
    const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const formatted = `${withThousands}.${fraction}`;

    if (this.#moneyFormat && this.#moneyFormat.includes('{{')) {
      return this.#moneyFormat
        .replace(/\{\{\s*amount_no_decimals\s*\}\}/g, withThousands)
        .replace(/\{\{\s*amount_with_comma_separator\s*\}\}/g, formatted.replace(/,/g, ' ').replace('.', ','))
        .replace(/\{\{\s*amount\s*\}\}/g, formatted)
        .replace(/\{\{\s*amount_no_decimals_with_comma_separator\s*\}\}/g, withThousands)
        .replace(/\{\{[^}]*\}\}/g, formatted);
    }

    return `$${formatted}`;
  }

  /**
   * Updates the hidden variant id, price, availability, and submit label to match the current selection.
   */
  #syncSelectedVariant() {
    const { variantId, price, comparePrice, submit, submitLabel, error } = this.refs;
    const variant = this.#resolveSelectedVariant();

    if (error) error.textContent = '';

    if (!variant) {
      if (submit) submit.disabled = true;
      if (submitLabel) submitLabel.textContent = 'Unavailable';
      return;
    }

    if (variantId) variantId.value = String(variant.id);

    const priceText = this.#formatMoney(variant.price);
    if (price) price.textContent = priceText;
    if (comparePrice) {
      if (variant.compare_at_price && variant.compare_at_price > variant.price) {
        comparePrice.textContent = this.#formatMoney(variant.compare_at_price);
        comparePrice.hidden = false;
      } else {
        comparePrice.textContent = '';
        comparePrice.hidden = true;
      }
    }

    const isAvailable = Boolean(variant.available);
    if (submit) submit.disabled = !isAvailable;

    if (submitLabel) {
      if (!isAvailable) {
        submitLabel.textContent = 'Sold out';
      } else {
        const action = this.#mode === 'line' ? 'Update' : 'Add';
        submitLabel.textContent = `${action} | ${priceText}`;
      }
    }
  }

  /**
   * Handles the options form submit.
   * @param {SubmitEvent} event
   */
  async handleSubmit(event) {
    event.preventDefault();

    const { submit, quantity, error } = this.refs;
    const variant = this.#resolveSelectedVariant();

    if (!variant || !variant.available) {
      this.#showError('Please choose an available option.');
      return;
    }

    const sellingPlan = this.#getSelectedSellingPlan();
    const requestedQuantity = Math.max(1, Number(quantity?.value) || 1);

    const isSameLine =
      this.#mode === 'line' &&
      this.#lineKey !== '' &&
      String(variant.id) === String(this.#originalVariantId) &&
      (sellingPlan || '') === (this.#originalSellingPlan || '');

    if (submit) submit.disabled = true;
    if (error) error.textContent = '';
    this.setAttribute('aria-busy', 'true');

    const deferredUpdatePromise = CartLinesUpdateEvent.createPromise();

    /** @type {string} */
    let url;
    /** @type {string} */
    let body;

    if (isSameLine) {
      const newQuantity = this.#currentQuantity + requestedQuantity;
      url = Theme.routes.cart_change_url;
      body = JSON.stringify({
        id: this.#lineKey,
        quantity: newQuantity,
        sections: CART_SECTION_ID,
        sections_url: window.location.pathname,
      });

      this.dispatchEvent(
        new CartLinesUpdateEvent({
          action: 'update',
          context: 'cart',
          lines: [{ id: this.#lineKey, quantity: newQuantity }],
          promise: deferredUpdatePromise.promise,
        })
      );
    } else {
      /** @type {Record<string, string | number>} */
      const item = { id: variant.id, quantity: requestedQuantity };
      if (sellingPlan) item.selling_plan = sellingPlan;

      url = Theme.routes.cart_add_url;
      body = JSON.stringify({
        items: [item],
        sections: CART_SECTION_ID,
        sections_url: window.location.pathname,
      });

      this.dispatchEvent(
        new CartLinesUpdateEvent({
          action: 'add',
          context: 'cart',
          lines: [{ merchandiseId: String(variant.id), quantity: requestedQuantity }],
          promise: deferredUpdatePromise.promise,
        })
      );
    }

    try {
      const response = await fetch(url, fetchConfig('json', { body }));
      const parsed = await response.json();

      if (parsed.status || parsed.errors) {
        const message = parsed.description || parsed.message || parsed.errors || 'Unable to update cart';
        this.#showError(message);
        deferredUpdatePromise.reject(new Error(message));
        this.dispatchEvent(new CartErrorEvent({ error: message, code: 'INVALID' }));
        return;
      }

      const sections = /** @type {Record<string, string> | undefined} */ (parsed.sections);

      // /cart/add.js returns the added line(s), not the cart — fetch the cart for the event payload.
      const ajaxCart = isSameLine ? parsed : await this.#fetchCart();
      const parsedItemCount = Number(ajaxCart?.item_count);

      deferredUpdatePromise.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(ajaxCart),
        detail: {
          sections,
          items: ajaxCart?.items,
          itemCount: Number.isFinite(parsedItemCount) ? parsedItemCount : 0,
          source: 'cart-options-drawer',
          didError: false,
        },
      });

      this.closeDialog();
    } catch (fetchError) {
      const message = fetchError?.message || 'Unable to update cart';
      this.#showError(message);
      deferredUpdatePromise.reject(fetchError);
      this.dispatchEvent(new CartErrorEvent({ error: message, code: 'SERVICE_UNAVAILABLE' }));
    } finally {
      if (submit) submit.disabled = false;
      this.removeAttribute('aria-busy');
    }
  }

  /**
   * @returns {Promise<any>}
   */
  async #fetchCart() {
    const response = await fetch(`${Theme.routes.cart_url}.js`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`Failed to fetch cart: ${response.status}`);
    return response.json();
  }

  /**
   * @param {string} message
   */
  #showError(message) {
    const { error } = this.refs;
    if (!error) return;
    error.textContent = message;
  }
}

if (!customElements.get('cart-options-drawer')) {
  customElements.define('cart-options-drawer', CartOptionsDrawer);
}
