import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

/**
 * A custom element that toggles a selling plan (subscription) on a cart line item.
 *
 * Host attributes:
 * - `data-line-key` – the cart line item key
 * - `data-quantity` – the current line quantity
 * - `data-selling-plan-id` – the selling plan id to apply when the switch is turned on
 *
 * @typedef {object} Refs
 * @property {HTMLInputElement} toggle - The role="switch" checkbox.
 * @property {HTMLSelectElement} [planSelect] - Optional plan selector.
 *
 * @extends {Component<Refs>}
 */
class CartLineSubscription extends Component {
  requiredRefs = ['toggle'];

  /** @type {AbortController | null} */
  #abortController = null;

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
  }

  /**
   * Handles the subscription switch change.
   * @param {Event} event - The change event.
   */
  async toggleSubscription(event) {
    const { toggle, planSelect } = this.refs;
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : toggle;
    const checked = input.checked;
    const previousState = !checked;

    const lineKey = this.dataset.lineKey;
    if (!lineKey) return;

    const quantity = Number(this.dataset.quantity) || 1;
    const planId = planSelect?.value || this.dataset.sellingPlanId || '';

    if (checked && !planId) {
      input.checked = previousState;
      return;
    }

    this.#abortController?.abort();
    this.#abortController = new AbortController();

    const sectionId = 'cart-drawer-section';
    const body = JSON.stringify({
      id: lineKey,
      quantity,
      selling_plan: checked ? planId : null,
      sections: sectionId,
      sections_url: window.location.pathname,
    });

    const deferredUpdatePromise = CartLinesUpdateEvent.createPromise();

    input.disabled = true;
    this.setAttribute('aria-busy', 'true');

    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'update',
        context: 'cart',
        lines: [{ id: lineKey, quantity }],
        promise: deferredUpdatePromise.promise,
      })
    );

    try {
      const response = await fetch(`${Theme.routes.cart_change_url}`, {
        ...fetchConfig('json', { body }),
        signal: this.#abortController.signal,
      });
      const parsed = await response.json();

      if (parsed.errors || parsed.status) {
        const message = parsed.errors || parsed.message || 'Unable to update subscription';
        input.checked = previousState;
        deferredUpdatePromise.reject(new Error(message));
        this.dispatchEvent(new CartErrorEvent({ error: message, code: 'INVALID' }));
        return;
      }

      const sections = /** @type {Record<string, string> | undefined} */ (parsed.sections);
      const parsedItemCount = Number(parsed.item_count);

      deferredUpdatePromise.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(parsed),
        detail: {
          sections,
          items: parsed.items,
          itemCount: Number.isFinite(parsedItemCount) ? parsedItemCount : 0,
          source: 'cart-line-subscription',
          didError: false,
        },
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      input.checked = previousState;
      deferredUpdatePromise.reject(error);
      this.dispatchEvent(
        new CartErrorEvent({
          error: error?.message || 'Unable to update subscription',
          code: 'SERVICE_UNAVAILABLE',
        })
      );
    } finally {
      input.disabled = false;
      this.removeAttribute('aria-busy');
      this.#abortController = null;
    }
  }
}

if (!customElements.get('cart-line-subscription')) {
  customElements.define('cart-line-subscription', CartLineSubscription);
}
