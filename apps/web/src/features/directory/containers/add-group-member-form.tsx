import { GROUP_MEMBER_ROLES, type GroupMember, type GroupMemberRole } from '@iam/contracts';
import { Button, FormField, NativeSelect, RadioGroup, SearchInput, Spinner } from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { useDebouncedCommit } from '../../../shared/lib';
import { addGroupMember, fetchMemberCandidates, groupsKeys } from '../api/groups-api';
import { DEFAULT_MEMBER_ROLE, memberCandidates } from '../model/groups-model';

/** Mismo tiempo de frescura que la búsqueda de personas del directorio. */
const CANDIDATES_STALE_MS = 30_000;

export type AddGroupMemberFormProps = {
  groupId: string;
  /** Miembros actuales: no se vuelven a ofrecer. */
  members: readonly GroupMember[];
  /** Éxito: recibe la lista de miembros que devolvió el servidor y el nombre de la persona agregada. */
  onAdded: (members: GroupMember[], personName: string) => void;
};

/**
 * Formulario de agregar una persona al grupo: búsqueda en el directorio, elección y rol. La
 * persona elegida se guarda aparte de los resultados para que seguir buscando no la pierda.
 */
export function AddGroupMemberForm({ groupId, members, onAdded }: AddGroupMemberFormProps) {
  const { t } = useTranslation(['directory', 'common', 'errors']);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useDebouncedCommit(query, setQuery);
  const [selected, setSelected] = useState<{ id: string; name: string } | undefined>(undefined);
  const [role, setRole] = useState<GroupMemberRole>(DEFAULT_MEMBER_ROLE);

  const action = useAsyncAction((userId: string, memberRole: GroupMemberRole) =>
    addGroupMember(groupId, { userId, role: memberRole }),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const candidates = useQuery({
    queryKey: groupsKeys.candidates(query),
    queryFn: ({ signal }) => fetchMemberCandidates(query, signal),
    staleTime: CANDIDATES_STALE_MS,
  });
  const eligible = memberCandidates(candidates.data?.data ?? [], members, role);

  async function submit() {
    if (selected === undefined) return;
    const result = await action.run(selected.id, role);
    if (!result.ok) return;
    onAdded(result.value, selected.name);
    setSelected(undefined);
    setRole(DEFAULT_MEMBER_ROLE);
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <h3 className="font-heading text-sm font-semibold text-text">
        {t('groups.members.add.title')}
      </h3>
      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <SearchInput
        label={t('groups.members.add.search')}
        clearLabel={t('search.clear', { ns: 'common' })}
        placeholder={t('search.placeholder', { ns: 'common' })}
        value={draft}
        onValueChange={setDraft}
      />
      {candidates.isError ? (
        <ErrorAlert
          error={candidates.error}
          onRetry={() => {
            void candidates.refetch();
          }}
        />
      ) : null}
      {/* Región siempre montada: un `role="status"` que aparece ya con su texto no se anuncia. */}
      <div
        role="status"
        className="flex items-center gap-2 text-sm text-text-secondary empty:hidden"
      >
        {candidates.isPending ? (
          <>
            <Spinner />
            {t('groups.members.add.searchLoading')}
          </>
        ) : null}
      </div>
      {candidates.data !== undefined && eligible.length === 0 ? (
        <p className="text-sm text-text-secondary">
          {t(
            role === 'manager'
              ? 'groups.members.add.searchEmptyManager'
              : 'groups.members.add.searchEmpty',
          )}
        </p>
      ) : null}
      {eligible.length > 0 ? (
        <RadioGroup
          legend={t('groups.members.add.legend')}
          className="max-h-48 overflow-y-auto"
          options={eligible.map((person) => ({
            value: person.id,
            label: person.displayName,
            description: person.email,
          }))}
          value={selected?.id}
          onValueChange={(personId) => {
            const person = eligible.find((candidate) => candidate.id === personId);
            setSelected(
              person === undefined ? undefined : { id: person.id, name: person.displayName },
            );
            action.reset();
          }}
        />
      ) : null}
      <FormField label={t('groups.members.add.role')} required>
        {(field) => (
          <NativeSelect
            {...field}
            value={role}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setRole(event.target.value as GroupMemberRole);
              // Al pasar a gestor la persona elegida puede dejar de ser elegible por su rango.
              setSelected(undefined);
            }}
          >
            {GROUP_MEMBER_ROLES.map((memberRole) => (
              <option key={memberRole} value={memberRole}>
                {t(`groups.role.${memberRole}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="flex justify-end">
        <Button
          type="submit"
          loading={action.pending}
          disabled={selected === undefined || cooldown.secondsLeft > 0}
        >
          {t('groups.members.add.submit')}
        </Button>
      </div>
    </form>
  );
}
