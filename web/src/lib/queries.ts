/**
 * queries.ts -- shared react-query hooks for enumerable reference data
 * (dropdowns). Keys are the resource names, so any mutation can invalidate
 * exactly what changed.
 */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "./api.ts";

export const useAddOns = () =>
  useQuery({
    queryKey: ["add-on"],
    queryFn: () => unwrap(api.v0["add-on"].$get()),
  });
export const useCoupons = () =>
  useQuery({
    queryKey: ["coupon"],
    queryFn: () => unwrap(api.v0.coupon.$get()),
  });
export const useCouponTemplates = () =>
  useQuery({
    queryKey: ["coupon-template"],
    queryFn: () => unwrap(api.v0["coupon-template"].$get()),
  });
export const useCycles = () =>
  useQuery({ queryKey: ["cycle"], queryFn: () => unwrap(api.v0.cycle.$get()) });
export const useExperiments = () =>
  useQuery({
    queryKey: ["experiment"],
    queryFn: () => unwrap(api.v0.experiment.$get()),
  });
export const useFeatures = () =>
  useQuery({
    queryKey: ["feature"],
    queryFn: () => unwrap(api.v0.feature.$get()),
  });
export const useMeters = () =>
  useQuery({ queryKey: ["meter"], queryFn: () => unwrap(api.v0.meter.$get()) });
export const usePlans = () =>
  useQuery({ queryKey: ["plan"], queryFn: () => unwrap(api.v0.plan.$get()) });
export const useTaxes = () =>
  useQuery({ queryKey: ["tax"], queryFn: () => unwrap(api.v0.tax.$get()) });
export const useTaxTypes = () =>
  useQuery({
    queryKey: ["tax-type"],
    queryFn: () => unwrap(api.v0["tax-type"].$get()),
  });
export const useTeamMembers = () =>
  useQuery({
    queryKey: ["team-member"],
    queryFn: () => unwrap(api.v0["team-member"].$get()),
  });
export const useTenants = () =>
  useQuery({
    queryKey: ["tenant"],
    queryFn: () => unwrap(api.v0.tenant.$get()),
  });
export const useValues = () =>
  useQuery({ queryKey: ["value"], queryFn: () => unwrap(api.v0.value.$get()) });
