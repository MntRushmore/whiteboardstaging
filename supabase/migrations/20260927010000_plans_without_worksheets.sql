-- Worksheets left the product with the image pipeline (branch feat/screens-no-image-model): no plan
-- lists them any more. Removes the element wherever it is, so a plan edited by hand keeps the rest.
update public.plans
   set features = features - 'Worksheets'
 where features ? 'Worksheets';
