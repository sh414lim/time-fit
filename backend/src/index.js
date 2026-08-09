import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN?.split(',') || true }));
app.use(express.json());

const employeeInput = z.object({
  organizationId: z.string().min(1), workplaceId: z.string().optional(), name: z.string().min(2),
  phone: z.string().optional(), department: z.string().optional(), jobTitle: z.string().optional(),
  joinedAt: z.coerce.date(), employmentType: z.enum(['HOURLY', 'SALARIED', 'DAILY', 'CONTRACTOR']),
  hourlyWage: z.coerce.number().positive().optional(), monthlySalary: z.coerce.number().positive().optional(),
});
const attendanceInput = z.object({ employeeId: z.string(), workplaceId: z.string().optional(), workDate: z.coerce.date() });
const leaveInput = z.object({ employeeId: z.string(), leavePolicyId: z.string(), startedAt: z.coerce.date(), endedAt: z.coerce.date(), amount: z.coerce.number().positive(), reason: z.string().max(500).optional() });

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const parse = (schema, payload) => { const result = schema.safeParse(payload); if (!result.success) throw Object.assign(new Error('Invalid request'), { status: 400, details: result.error.flatten() }); return result.data; };

app.get('/health', (_, res) => res.json({ ok: true, service: 'timefit-api' }));
app.get('/api/v1/employees', asyncRoute(async (req, res) => {
  const employees = await prisma.employee.findMany({ where: { organizationId: String(req.query.organizationId), status: 'ACTIVE' }, include: { workplace: true, contracts: { where: { isCurrent: true }, take: 1 } }, orderBy: { name: 'asc' } });
  res.json({ data: employees });
}));
app.post('/api/v1/employees', asyncRoute(async (req, res) => {
  const input = parse(employeeInput, req.body);
  const employee = await prisma.employee.create({ data: { organizationId: input.organizationId, workplaceId: input.workplaceId, name: input.name, phone: input.phone, department: input.department, jobTitle: input.jobTitle, joinedAt: input.joinedAt, contracts: { create: { employmentType: input.employmentType, startedOn: input.joinedAt, hourlyWage: input.hourlyWage, monthlySalary: input.monthlySalary } } }, include: { contracts: true } });
  res.status(201).json({ data: employee });
}));
app.post('/api/v1/attendances/check-in', asyncRoute(async (req, res) => {
  const input = parse(attendanceInput, req.body);
  const record = await prisma.attendanceRecord.upsert({ where: { employeeId_workDate: { employeeId: input.employeeId, workDate: input.workDate } }, create: { ...input, checkedInAt: new Date(), status: 'WORKING' }, update: { checkedInAt: new Date(), status: 'WORKING' } });
  res.json({ data: record });
}));
app.post('/api/v1/attendances/:id/check-out', asyncRoute(async (req, res) => {
  const record = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!record.checkedInAt) return res.status(409).json({ message: '출근 기록이 없습니다.' });
  const workedMinutes = Math.max(0, Math.floor((Date.now() - record.checkedInAt.getTime()) / 60000) - record.breakMinutes);
  const updated = await prisma.attendanceRecord.update({ where: { id: record.id }, data: { checkedOutAt: new Date(), workedMinutes, status: 'COMPLETED' } });
  res.json({ data: updated });
}));
app.post('/api/v1/leave-requests', asyncRoute(async (req, res) => {
  const input = parse(leaveInput, req.body);
  const request = await prisma.leaveRequest.create({ data: input });
  res.status(201).json({ data: request });
}));
app.post('/api/v1/leave-requests/:id/approve', asyncRoute(async (req, res) => {
  const request = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.params.id }, include: { employee: true, leavePolicy: true } });
  if (request.status !== 'PENDING') return res.status(409).json({ message: '대기 중인 요청만 승인할 수 있습니다.' });
  const year = request.startedAt.getUTCFullYear();
  const result = await prisma.$transaction(async tx => {
    const approved = await tx.leaveRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', reviewedAt: new Date() } });
    await tx.leaveBalance.upsert({ where: { employeeId_leavePolicyId_year: { employeeId: request.employeeId, leavePolicyId: request.leavePolicyId, year } }, create: { employeeId: request.employeeId, leavePolicyId: request.leavePolicyId, year, usedAmount: request.amount }, update: { usedAmount: { increment: request.amount } } });
    return approved;
  });
  res.json({ data: result });
}));

app.use((error, _, res, __) => { console.error(error); res.status(error.status || 500).json({ message: error.message || '서버 오류', details: error.details }); });
const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`TimeFit API listening on :${port}`));
