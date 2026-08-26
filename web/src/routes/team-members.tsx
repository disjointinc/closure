import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { teamMemberSchema } from "../../../api/schemas/team-member.ts";
import { asJson, ErrorBox, NoteBox, Page } from "./-components/feedback.tsx";
import { Field, TextInput } from "./-components/fields.tsx";
import { IdInput } from "./-components/pickers.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";

export const Route = createFileRoute("/team-members")({
  component: TeamMembersPage,
});

const emptyForm = () => ({
  unique_id: generateId("team_member"),
  email_address: "",
  name: "",
  profile_picture_link: "",
});

function TeamMembersPage() {
  const queryClient = useQueryClient();
  const teamMembers = useQuery({
    queryKey: ["team-member"],
    queryFn: () => unwrap(api.v0["team-member"].$get()),
  });
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPicture, setEditPicture] = useState("");

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["team-member"] });

  const create = useMutation({
    mutationFn: async () => {
      const parsed = teamMemberSchema.safeParse({
        unique_id: form.unique_id,
        deleted_at: null,
        email_address: form.email_address,
        name: form.name === "" ? null : form.name,
        profile_picture_link:
          form.profile_picture_link === "" ? null : form.profile_picture_link,
      });
      if (!parsed.success) {
        throw new Error(z.prettifyError(parsed.error));
      }
      return unwrap(api.v0["team-member"].$post({ json: parsed.data }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data.unique_id}`);
      setError(null);
      setForm(emptyForm());
      refresh();
    },
    onError: (mutationError) => {
      setCreated(null);
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : String(mutationError),
      );
    },
  });

  const patch = useMutation({
    mutationFn: async (uniqueId: string) =>
      unwrap(
        api.v0["team-member"][":id"].$patch({
          param: { id: uniqueId },
          json: {
            name: editName === "" ? null : editName,
            profile_picture_link: editPicture === "" ? null : editPicture,
          },
        }),
      ),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (mutationError) => setError(String(mutationError)),
  });

  const remove = useMutation({
    mutationFn: (uniqueId: string) =>
      unwrap(api.v0["team-member"][":id"].$delete({ param: { id: uniqueId } })),
    onSuccess: refresh,
    onError: (mutationError) => setError(String(mutationError)),
  });

  return (
    <Page
      title="Team members"
      sub="The people running Closure. Soft-deleted so their audit trail (grants, overrides) survives."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Email", cell: (row) => row.email_address },
          {
            header: "Name",
            cell: (row) =>
              editing === row.unique_id ? (
                <TextInput value={editName} onChange={setEditName} />
              ) : (
                (row.name ?? "—")
              ),
          },
          {
            header: "Picture",
            cell: (row) =>
              editing === row.unique_id ? (
                <TextInput value={editPicture} onChange={setEditPicture} />
              ) : (
                (row.profile_picture_link ?? "—")
              ),
          },
          {
            header: "Status",
            cell: (row) =>
              row.deleted_at ? (
                <span className="pill warn">deleted</span>
              ) : (
                <span className="pill ok">active</span>
              ),
          },
          {
            header: "",
            cell: (row) =>
              editing === row.unique_id ? (
                <span>
                  <button
                    className="small primary"
                    onClick={(event) => {
                      event.stopPropagation();
                      patch.mutate(row.unique_id);
                    }}
                  >
                    Save
                  </button>{" "}
                  <button
                    className="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditing(null);
                    }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <span>
                  <button
                    className="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditing(row.unique_id);
                      setEditName(row.name ?? "");
                      setEditPicture(row.profile_picture_link ?? "");
                    }}
                  >
                    Edit
                  </button>{" "}
                  {row.deleted_at ? null : (
                    <button
                      className="danger small"
                      onClick={(event) => {
                        event.stopPropagation();
                        remove.mutate(row.unique_id);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </span>
              ),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No team members yet."
        keyOf={(row) => row.unique_id}
        rows={teamMembers.data ?? []}
      />

      <div className="panel">
        <h2>Add team member</h2>
        <Field label="Id">
          <IdInput
            prefix="team_member"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <Field label="Email">
          <TextInput
            value={form.email_address}
            onChange={(email_address) => setForm({ ...form, email_address })}
          />
        </Field>
        <Field label="Name">
          <TextInput
            value={form.name}
            onChange={(name) => setForm({ ...form, name })}
          />
        </Field>
        <Field label="Profile picture URL">
          <TextInput
            value={form.profile_picture_link}
            onChange={(profile_picture_link) =>
              setForm({ ...form, profile_picture_link })
            }
          />
        </Field>
        <ErrorBox error={error} />
        {created ? <NoteBox>{created}</NoteBox> : null}
        <button
          className="primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Add team member
        </button>
      </div>
    </Page>
  );
}
