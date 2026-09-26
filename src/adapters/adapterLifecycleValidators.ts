import {
  DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID,
  validateDeepbookSwapReviewLifecycle
} from "./deepbook/deepbookReviewLifecycle.js";
import { createAdapterLifecycleValidator } from "../core/action/adapterLifecycleValidation.js";

export const validateSupportedAdapterLifecycle = createAdapterLifecycleValidator({
  [DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID]: validateDeepbookSwapReviewLifecycle
});
