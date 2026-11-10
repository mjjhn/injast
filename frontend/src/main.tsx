import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GoalsList } from "./features/GoalsList";
import { Loading } from "./design-system/atoms/Loading";
import "@fontsource-variable/vazirmatn";
import "./styles.css";

const CreateGoal = lazy(() =>
  import("./features/CreateGoal").then((module) => ({
    default: module.CreateGoal,
  })),
);
const GoalDetail = lazy(() =>
  import("./features/GoalDetail").then((module) => ({
    default: module.GoalDetail,
  })),
);

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 0 },
    mutations: { retry: false },
  },
});
function DetailRoute() {
  const { id = "" } = useParams();
  return <GoalDetail key={id} id={id} />;
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <a href="#main-content" className="skip-link">
          رفتن به محتوا
        </a>
        <Suspense
          fallback={
            <div className="app-shell">
              <Loading />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<GoalsList />} />
            <Route path="/goals/new" element={<CreateGoal />} />
            <Route path="/goals/:id" element={<DetailRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
